import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Release signing: read from a file OUTSIDE the repo (default ~/.vishwaship/upload-keystore.properties)
// or from environment variables in CI. Nothing secret is ever committed or bundled.
val signingProps = Properties().apply {
    val f = file(System.getenv("VISHWASHIP_SIGNING_PROPERTIES") ?: "${System.getProperty("user.home")}/.vishwaship/upload-keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun prop(name: String): String = (project.findProperty(name) as String?) ?: ""

android {
    namespace = "in.vishwaship.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "in.vishwaship.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "1.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "FIREBASE_PROJECT_ID", "\"${prop("vishwaship.firebase.projectId")}\"")
        buildConfigField("String", "FIREBASE_APP_ID", "\"${prop("vishwaship.firebase.appId")}\"")
        buildConfigField("String", "FIREBASE_API_KEY", "\"${prop("vishwaship.firebase.apiKey")}\"")
        buildConfigField("String", "FIREBASE_SENDER_ID", "\"${prop("vishwaship.firebase.senderId")}\"")
    }

    flavorDimensions += "env"
    productFlavors {
        create("staging") {
            dimension = "env"
            applicationIdSuffix = ".staging"
            versionNameSuffix = "-staging"
            // Android emulator → this PC's dev server. Override with -Pvishwaship.stagingUrl=https://staging.example
            buildConfigField("String", "API_BASE_URL", "\"${(project.findProperty("vishwaship.stagingUrl") as String?) ?: "http://10.0.2.2:3000"}\"")
            buildConfigField("String", "WEB_HOST", "\"${(project.findProperty("vishwaship.stagingHost") as String?) ?: "staging.vishwaship.in"}\"")
            resValue("string", "app_name", "Vishwaship Staging")
            manifestPlaceholders["webHost"] = (project.findProperty("vishwaship.stagingHost") as String?) ?: "staging.vishwaship.in"
            manifestPlaceholders["usesCleartext"] = "true"
            // The app shows the website itself (Trusted Web Activity), so site changes appear in the app at once.
            manifestPlaceholders["twaUrl"] = ((project.findProperty("vishwaship.stagingUrl") as String?) ?: "http://10.0.2.2:3000") + "/portal/"
        }
        create("production") {
            dimension = "env"
            buildConfigField("String", "API_BASE_URL", "\"https://vishwaship.in\"")
            buildConfigField("String", "WEB_HOST", "\"vishwaship.in\"")
            resValue("string", "app_name", "Vishwaship")
            manifestPlaceholders["webHost"] = "vishwaship.in"
            manifestPlaceholders["usesCleartext"] = "false"
            manifestPlaceholders["twaUrl"] = "https://vishwaship.in/portal/"
        }
    }

    signingConfigs {
        create("upload") {
            val store = signingProps.getProperty("storeFile") ?: System.getenv("VISHWASHIP_UPLOAD_STORE_FILE")
            if (store != null) {
                storeFile = file(store)
                storePassword = signingProps.getProperty("storePassword") ?: System.getenv("VISHWASHIP_UPLOAD_STORE_PASSWORD")
                keyAlias = signingProps.getProperty("keyAlias") ?: System.getenv("VISHWASHIP_UPLOAD_KEY_ALIAS")
                keyPassword = signingProps.getProperty("keyPassword") ?: System.getenv("VISHWASHIP_UPLOAD_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Unsigned when no upload key is configured (Play App Signing re-signs; upload must be signed by the owner).
            signingConfig = signingConfigs.getByName("upload").takeIf { it.storeFile != null }
        }
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
        freeCompilerArgs += listOf(
            "-opt-in=androidx.compose.material3.ExperimentalMaterial3Api",
            "-opt-in=androidx.compose.foundation.layout.ExperimentalLayoutApi",
        )
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging { resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" } }
    testOptions { unitTests.isReturnDefaultValues = true }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material3.adaptive)
    implementation(libs.compose.icons.extended)
    implementation(libs.navigation.compose)
    implementation(libs.okhttp)
    implementation(libs.serialization.json)
    implementation(libs.coroutines.android)
    implementation(libs.coroutines.play.services)
    implementation(libs.androidx.browser)
    implementation(libs.android.browser.helper)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    implementation(libs.razorpay.checkout)
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}
