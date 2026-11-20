package `in`.vishwaship.app

import android.app.Application
import `in`.vishwaship.app.data.Api
import `in`.vishwaship.app.data.Repository
import `in`.vishwaship.app.data.SecureStore
import `in`.vishwaship.app.push.Push

class VishwashipApp : Application() {
    lateinit var repo: Repository
        private set

    override fun onCreate() {
        super.onCreate()
        val store = SecureStore(this)
        repo = Repository(Api(BuildConfig.API_BASE_URL, store), store)
        Push.createChannels(this)
        Push.initFirebaseIfConfigured(this)
    }
}
