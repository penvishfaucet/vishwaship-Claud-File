package `in`.vishwaship.app.core

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream

/** Native open / share / print for PDFs kept in app-private cache (no storage permission needed). */
object FileActions {
    private fun uri(ctx: Context, f: File): Uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", f)

    fun open(ctx: Context, f: File): Boolean = try {
        ctx.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri(ctx, f), "application/pdf").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)); true
    } catch (_: ActivityNotFoundException) { false }

    fun share(ctx: Context, f: File, title: String) {
        val send = Intent(Intent.ACTION_SEND).setType("application/pdf").putExtra(Intent.EXTRA_STREAM, uri(ctx, f)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        ctx.startActivity(Intent.createChooser(send, title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** Prints the server's PDF unchanged, so thermal label sizes and barcodes stay exact. */
    fun print(ctx: Context, f: File, jobName: String) {
        val pm = ctx.getSystemService(Context.PRINT_SERVICE) as PrintManager
        pm.print(jobName, object : PrintDocumentAdapter() {
            override fun onLayout(old: PrintAttributes?, new: PrintAttributes?, cancel: CancellationSignal?, cb: LayoutResultCallback, extras: Bundle?) {
                if (cancel?.isCanceled == true) { cb.onLayoutCancelled(); return }
                cb.onLayoutFinished(PrintDocumentInfo.Builder(f.name).setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).build(), true)
            }
            override fun onWrite(pages: Array<out PageRange>?, dest: ParcelFileDescriptor, cancel: CancellationSignal?, cb: WriteResultCallback) {
                f.inputStream().use { input -> FileOutputStream(dest.fileDescriptor).use { input.copyTo(it) } }
                cb.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
            }
        }, null)
    }

    /** Copy a picked document/photo (system picker URI) into private cache for upload. Max 10 MB. */
    fun importPicked(ctx: Context, uri: Uri): Pair<File, String>? {
        val cr = ctx.contentResolver
        val mime = cr.getType(uri) ?: "application/octet-stream"
        val name = cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null } ?: "upload"
        val safe = name.replace(Regex("[^\\w.\\-]"), "_").takeLast(80)
        val out = File(ctx.cacheDir, "uploads/${System.currentTimeMillis()}-$safe").apply { parentFile?.mkdirs() }
        cr.openInputStream(uri)?.use { input -> out.outputStream().use { input.copyTo(it) } } ?: return null
        if (out.length() > 10 * 1024 * 1024) { out.delete(); return null }
        return out to mime
    }

    /** Called on sign-out: account files never outlive the session on this device. */
    fun clearAccountFiles(ctx: Context) {
        File(ctx.cacheDir, "documents").deleteRecursively()
        File(ctx.cacheDir, "uploads").deleteRecursively()
    }
}
