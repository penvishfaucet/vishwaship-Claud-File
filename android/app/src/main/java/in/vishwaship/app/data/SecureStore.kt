package `in`.vishwaship.app.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Session token storage. The token is encrypted with an AES-256-GCM key that lives in the Android Keystore
 * (never exportable, excluded from backups), so a copied app-data folder is useless on another device.
 */
class SecureStore(context: Context) {
    private val prefs = context.getSharedPreferences("vs_secure", Context.MODE_PRIVATE)
    private val alias = "vishwaship_session_key"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    private fun encrypt(plain: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val out = c.iv + c.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(out, Base64.NO_WRAP)
    }

    private fun decrypt(blob: String): String? = runCatching {
        val raw = Base64.decode(blob, Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw, 0, 12)) }
        String(c.doFinal(raw, 12, raw.size - 12), Charsets.UTF_8)
    }.getOrNull()

    var token: String?
        get() = prefs.getString("t", null)?.let(::decrypt)
        set(v) { prefs.edit().apply { if (v == null) remove("t") else putString("t", encrypt(v)) }.apply() }

    var refreshAfter: String?
        get() = prefs.getString("ra", null)
        set(v) { prefs.edit().putString("ra", v).apply() }

    /** Random per-install id (not a hardware id). Lets the server re-assign this device cleanly between accounts. */
    val installId: String
        get() = prefs.getString("iid", null) ?: UUID.randomUUID().toString().also { prefs.edit().putString("iid", it).apply() }

    /** Sign-out: forget the session (the install id stays so the server can detach this device). */
    fun clearSession() { prefs.edit().remove("t").remove("ra").apply() }
}
