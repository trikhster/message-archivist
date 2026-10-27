plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "io.github.trikhster.messagearchivist"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.trikhster.messagearchivist"
        minSdk = 26
        targetSdk = 35
        versionCode = 100
        versionName = "0.0.1.0"
    }

    // Release APKs are signed with the project's key, which never enters the
    // repo: the Release workflow decodes it from repository secrets and passes
    // its path and password in these variables (see notes/Releasing.md).
    // Without them a release build comes out unsigned.
    val releaseKey = System.getenv("MA_KEYSTORE")
    signingConfigs {
        if (releaseKey != null) create("release") {
            storeFile = file(releaseKey)
            storePassword = System.getenv("MA_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("MA_KEY_ALIAS") ?: "message-archivist"
            keyPassword = System.getenv("MA_KEYSTORE_PASSWORD")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (releaseKey != null) signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = true
        compose = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.animation:animation")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
