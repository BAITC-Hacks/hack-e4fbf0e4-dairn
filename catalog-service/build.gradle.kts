plugins {
    kotlin("jvm") version "2.1.10"
    `java-library`
}

repositories { mavenCentral() }

kotlin { jvmToolchain(21) }

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    testImplementation(kotlin("test-junit"))
}

tasks.test { useJUnit() }
