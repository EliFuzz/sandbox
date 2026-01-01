#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

SOURCE_DIR="$ROOT_DIR/scripts/seccomp"

if [ ! -d "$SOURCE_DIR" ]; then
    echo "Error: Source directory not found: $SOURCE_DIR"
    exit 1
fi

current_arch=$(uname -m)
if [ "$current_arch" = "x86_64" ]; then
    vendor_dir="x64"
    docker_platform="linux/amd64"
elif [ "$current_arch" = "arm64" ] || [ "$current_arch" = "aarch64" ]; then
    vendor_dir="arm64"
    docker_platform="linux/arm64"
else
    echo "Unsupported architecture: $current_arch"
    exit 1
fi

output_dir="$ROOT_DIR/dist/vendor/seccomp/$vendor_dir"
bpf_file="$output_dir/unix-block.bpf"
apply_seccomp_bin="$output_dir/apply-seccomp"

mkdir -p "$output_dir"

build_with_docker() {
    echo "Building with Docker for: $vendor_dir ($docker_platform)"

    if ! command -v docker &> /dev/null; then
        echo "Error: Docker is required but not found"
        exit 1
    fi

    docker run --rm --platform "$docker_platform" \
        -e UID=$(id -u) \
        -e GID=$(id -g) \
        -v "$SOURCE_DIR:/src:ro" \
        -v "$output_dir:/output" \
        ubuntu:22.04 sh -c "
            set -e
            apt-get update -qq
            apt-get install -y -qq gcc libseccomp-dev file > /dev/null

            gcc -o /output/seccomp-unix-block /src/seccomp-unix-block.c \
                -static -lseccomp \
                -O2 -Wall -Wextra

            strip /output/seccomp-unix-block
            chmod +x /output/seccomp-unix-block

            gcc -o /output/apply-seccomp /src/apply-seccomp.c \
                -static \
                -O2 -Wall -Wextra

            strip /output/apply-seccomp
            chmod +x /output/apply-seccomp

            if ! /output/seccomp-unix-block /output/unix-block.bpf 2>&1; then
                echo 'Error: Failed to generate BPF filter inside container'
                exit 1
            fi

            rm -f /output/seccomp-unix-block
            chown -R \$UID:\$GID /output 2>/dev/null || true
        " || {
            echo "Error: Docker build failed"
            exit 1
        }

    if [ ! -f "$bpf_file" ] || [ ! -f "$apply_seccomp_bin" ]; then
        echo "Error: Build completed but output files not found"
        exit 1
    fi

    echo "Docker build successful!"
}

build_natively() {
    echo "Building natively for: $vendor_dir ($current_arch)"

    local missing_deps=()
    if ! command -v gcc &> /dev/null; then
        missing_deps+=("gcc")
    fi

    if ! pkg-config --exists libseccomp 2>/dev/null; then
        missing_deps+=("libseccomp-dev")
    fi

    if [ ${#missing_deps[@]} -ne 0 ]; then
        echo "Error: Missing required dependencies: ${missing_deps[*]}"
        exit 1
    fi

    temp_dir=$(mktemp -d)
    trap "rm -rf $temp_dir" EXIT

    echo "Building seccomp-unix-block..."
    if ! gcc -o "$temp_dir/seccomp-unix-block" "$SOURCE_DIR/seccomp-unix-block.c" \
        -static -lseccomp \
        -O2 -Wall -Wextra; then
        echo "Error: Failed to compile seccomp-unix-block"
        exit 1
    fi

    strip "$temp_dir/seccomp-unix-block"
    chmod +x "$temp_dir/seccomp-unix-block"

    echo "Building apply-seccomp..."
    if ! gcc -o "$output_dir/apply-seccomp" "$SOURCE_DIR/apply-seccomp.c" \
        -static \
        -O2 -Wall -Wextra; then
        echo "Error: Failed to compile apply-seccomp"
        exit 1
    fi

    strip "$output_dir/apply-seccomp"
    chmod +x "$output_dir/apply-seccomp"

    echo "Generating BPF filter..."
    if ! "$temp_dir/seccomp-unix-block" "$bpf_file" 2>&1; then
        echo "Error: Failed to generate BPF filter"
        exit 1
    fi

    if [ ! -f "$bpf_file" ] || [ ! -f "$apply_seccomp_bin" ]; then
        echo "Error: Build completed but output files not found"
        exit 1
    fi

    echo "Native build successful!"
}

if [ "$(uname -s)" = "Linux" ]; then build_natively; else build_with_docker; fi

exit 0
