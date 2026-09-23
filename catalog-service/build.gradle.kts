plugins {
    kotlin("jvm") version "2.1.10"
    `java-library`
    application
}

repositories { mavenCentral() }

kotlin { jvmToolchain(21) }

dependencies {
    val ktorVersion = "3.1.1"
    implementation("io.ktor:ktor-server-core:$ktorVersion")
    implementation("io.ktor:ktor-server-netty:$ktorVersion")
    implementation("io.ktor:ktor-server-status-pages:$ktorVersion")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    testImplementation(kotlin("test-junit"))
    testImplementation("io.ktor:ktor-server-test-host:$ktorVersion")
}

application { mainClass.set("kz.hackalem.catalog.cli.EktCliKt") }

tasks.named<JavaExec>("run") {
    workingDir(rootProject.projectDir)
}

tasks.register<JavaExec>("runServer") {
    group = "application"
    description = "Run the existing Ktor catalog server separately from the EKT CLI"
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("kz.hackalem.catalog.ApplicationKt")
    workingDir(rootProject.projectDir)
}

tasks.test { useJUnit() }
