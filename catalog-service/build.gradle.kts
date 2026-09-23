plugins {
    kotlin("jvm") version "2.1.10"
    `java-library`
    application
}

repositories { mavenCentral() }

kotlin { jvmToolchain(21) }

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.1")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    testImplementation(kotlin("test-junit"))
}

tasks.test { useJUnit() }

application { mainClass.set("kz.hackalem.catalog.cli.EktCliKt") }
tasks.named<JavaExec>("run") { workingDir(rootProject.projectDir) }
