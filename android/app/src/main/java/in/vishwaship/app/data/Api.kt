package `in`.vishwaship.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

val AppJson = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true; isLenient = true }

/** A server or network failure with a message that is safe to show to the customer. */
class ApiException(val status: Int, val code: String, override val message: String, val body: JsonObject? = null) : Exception(message) {
    val isNetwork get() = status == 0
    val isUnauthorized get() = status == 401
}

/**
 * HTTP client for the Vishwaship backend. The session token goes in the Authorization header only; it is never
 * logged (no logging interceptor), never put in a URL, and never sent to any other host.
 */
class Api(private val baseUrl: String, private val store: SecureStore) {
    private val host = baseUrl.toHttpUrl().host
    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            val req = chain.request()
            val token = store.token
            val withAuth = if (token != null && req.url.host == host) req.newBuilder().header("Authorization", "Bearer $token").build() else req
            chain.proceed(withAuth.newBuilder().header("User-Agent", "VishwashipAndroid/${`in`.vishwaship.app.BuildConfig.VERSION_NAME}").build())
        }
        .build()

    private val _sessionExpired = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    /** Emits when the server rejects the token (expired, revoked, password changed): the app signs out safely. */
    val sessionExpired: SharedFlow<Unit> = _sessionExpired

    /**
     * The site runs with trailingSlash: true. A path without the slash gets a 308 redirect, which OkHttp does not
     * follow for POST, so every request uses the slash form (/api/x/ or /api/x/?q=1), like the website's own calls.
     * Fragments (#…) are left alone.
     */
    fun url(path: String): String = slashUrl(baseUrl, path)

    suspend fun get(path: String, query: Map<String, String?> = emptyMap()): String {
        val u = url(path).toHttpUrl().newBuilder().apply { query.forEach { (k, v) -> if (!v.isNullOrBlank()) addQueryParameter(k, v) } }.build()
        return exec(Request.Builder().url(u).get().build())
    }

    suspend fun send(method: String, path: String, json: String? = null): String {
        val body = (json ?: "{}").toRequestBody("application/json".toMediaType())
        return exec(Request.Builder().url(url(path)).method(method, body).build())
    }

    suspend fun multipart(path: String, fields: Map<String, String>, file: Pair<String, File>? = null, fileMime: String? = null): String {
        val b = MultipartBody.Builder().setType(MultipartBody.FORM)
        fields.forEach { (k, v) -> b.addFormDataPart(k, v) }
        if (file != null) b.addFormDataPart(file.first, file.second.name, file.second.asRequestBody(fileMime ?: "application/octet-stream"))
        return exec(Request.Builder().url(url(path)).post(b.build()).build())
    }

    /** Download a private document (label, manifest, invoice) to app cache. Follows the server's redirects on the same host. */
    suspend fun download(path: String, target: File): File = withContext(Dispatchers.IO) {
        val res = call(Request.Builder().url(url(path)).get().build())
        res.use {
            if (!it.isSuccessful) throw error(it.code, it.body?.string().orEmpty())
            target.parentFile?.mkdirs()
            it.body!!.byteStream().use { input -> target.outputStream().use { out -> input.copyTo(out) } }
        }
        target
    }

    private suspend fun exec(req: Request): String = withContext(Dispatchers.IO) {
        call(req).use { res ->
            val text = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw error(res.code, text)
            text
        }
    }

    private fun call(req: Request): Response = try {
        http.newCall(req).execute()
    } catch (e: IOException) {
        throw ApiException(0, "network", "No connection. Check your internet and try again.")
    }

    private fun error(status: Int, text: String): ApiException {
        val obj = runCatching { AppJson.parseToJsonElement(text).jsonObject }.getOrNull()
        val err = obj?.get("error")?.let { runCatching { it.jsonObject }.getOrNull() }
        val code = err?.get("code")?.jsonPrimitive?.contentOrNull ?: "http_$status"
        val message = err?.get("message")?.jsonPrimitive?.contentOrNull ?: when (status) {
            401 -> "Your session has ended. Please sign in again."
            403 -> "You don't have access to this."
            404 -> "Not found."
            429 -> "Too many requests. Please wait a moment."
            in 500..599 -> "The server is having trouble. Please try again shortly."
            else -> "Something went wrong (HTTP $status)."
        }
        if (status == 401 && store.token != null) _sessionExpired.tryEmit(Unit)
        return ApiException(status, code, message, err)
    }
}

/** base + path with the path's trailing slash ensured before any ?query or #fragment. */
fun slashUrl(baseUrl: String, path: String): String {
    val hash = path.indexOf('#').let { if (it < 0) path.length else it }
    val q = path.indexOf('?').let { if (it < 0 || it > hash) hash else it }
    val p = path.substring(0, q)
    val fixed = if (p.endsWith("/")) p else "$p/"
    return baseUrl.trimEnd('/') + fixed + path.substring(q)
}

private fun File.asRequestBody(mime: String): RequestBody = object : RequestBody() {
    override fun contentType() = mime.toMediaType()
    override fun contentLength() = length()
    override fun writeTo(sink: okio.BufferedSink) { inputStream().use { sink.outputStream().let { o -> it.copyTo(o) } } }
}
