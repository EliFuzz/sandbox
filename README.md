# SandBox

Lightweight, OS-native sandboxing solution on macOS (`sandbox-exec`) and Linux (`bubblewrap`).

## Features

- agentic code execution (AI agents): with minimal risk of data leaks or system compromise
- secure-by-default dual isolation: Untrusted code runs with strong restrictions - filesystem isolation prevents secret exfiltration (e.g., SSH keys), while network isolation blocks unrestricted outbound access
- minimal performance overhead: No containers / VMs required
- blazingly fast startup times: milliseconds
- cross-platform: macOS and Linux support
- highly configurable: fine-grained control over network and filesystem access
- easy to use: CLI and Node.js library

## Usage

### CLI

```bash
vsbx <command>                    # Run command sandboxed
vsbx --debug <command>            # Debug logging
vsbx --settings <file> <command>  # Custom config
```

### Node.js Library

```javascript
import { type SandboxRuntimeConfig } from "vsbx/core/sandbox/sandbox-config";
import { SandboxManager } from "vsbx/core/manager/sandbox-manager";
import { spawn } from "node:child_process";

const config: SandboxRuntimeConfig = {
  network: {
    allowedDomains: ["example.com", "api.github.com"],
    deniedDomains: [],
  },
  filesystem: {
    denyRead: ["~/.ssh"],
    allowWrite: [".", "/tmp"],
    denyWrite: [".env"],
  },
};

await SandboxManager.initialize(config);
const sandboxedCommand = await SandboxManager.wrapWithSandbox(
  "curl https://example.com",
);
const child = spawn(sandboxedCommand, { shell: true, stdio: "inherit" });

child.on("exit", (code) => console.log(`Command exited with code ${code}`));
await SandboxManager.reset();
```

## Configuration

```json
{
  "network": {
    "allowedDomains": [
      "api.github.com",
      "registry.npmjs.org",
      "objects.githubusercontent.com"
    ]
  },
  "filesystem": {
    "denyRead": ["~/.ssh", "~/.aws", "~/.config/gh"],
    "allowWrite": ["."]
  }
}
```

### Configuration Options

```json
{
  "network": {
    "allowedDomains":           string[],     // wildcards *. ok, empty = no network
    "deniedDomains":            string[],     // checked first, blocks even if in allowed
    "allowUnixSockets":         string[],     // macOS mostly - dangerous!
    "allowLocalBinding":        boolean       // default false - very dangerous
  },
  "filesystem": {
    "denyRead":                 string[],     // empty = read everywhere
    "allowWrite":               string[],     // empty = write nowhere ← most important!
    "denyWrite":                string[]      // exceptions inside allowWrite (stronger priority)
  },
  "ignoreViolations": {                       // rare - mostly for tooling workarounds
    "<command-pattern>":        string[]
  },
  "enableWeakerNestedSandbox":  boolean,      // only for running inside Docker (much weaker!)
  "mandatoryDenySearchDepth":   number        // Linux only - how deep to scan for dangerous files (default: 3)
}
```

### Default Permissions

| Resource             | Default State              | Restriction Style      | How to open access                    |
| -------------------- | -------------------------- | ---------------------- | ------------------------------------- |
| Network              | Completely blocked         | Allow-list only        | `allowedDomains: ["..."]`             |
| Filesystem - Read    | Allowed everywhere         | Deny-list only         | `denyRead: ["~/.ssh"]`                |
| Filesystem - Write   | Completely blocked         | Allow-list + deny-list | `allowWrite: ["."]` + `denyWrite: []` |
| Unix sockets (Linux) | Creation blocked (seccomp) | Explicit allow         | `allowUnixSockets: [...]`             |

## Comparison

| Aspect                      | SandBox (`sandbox-exec`, `bwrap`)                                           | Node.js VM                                           | Bun (Runtime/VM)                                      | microVM (Firecracker, Cloud Hypervisor)                                | Docker Container                                               |
| --------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| Definition                  | Sandbox that runs unprivileged processes in restrictive OS kernel sandboxes | Node.js module for isolated V8 JS contexts           | JS/TS runtime with JSCore and Node.js-style vm module | Lightweight VMs for secure short-lived workloads with minimal guest OS | Container platform using OS virtualization sharing host kernel |
| Platforms                   | macOS, Linux                                                                | Cross-platform                                       | Cross-platform                                        | Linux host (KVM); flexible guest OS                                    | Linux native; Windows/macOS via layers/VMs                     |
| Performance Overhead        | Minimal; near-native speeds with kernel namespaces/seccomp                  | Negligible; in-process V8 isolation, minor GC pauses | Low; JSCore optimizations, up to 4x throughput        | Moderate; <5% CPU penalty with KVM                                     | Low; 5-10% I/O slowdown vs native                              |
| Memory Overhead             | Extremely low; <1MB per process                                             | Minimal; shared process memory, small heap additions | Low; optimized JSCore memory management               | Low; <5MB per microVM with minimal kernel                              | Moderate; 10-50MB per container                                |
| Resource Efficiency         | High; reuses host resources directly                                        | Efficient for JS; shares CPU/memory, no quotas       | Superior to Node.js; better CPU utilization           | Strong density; 1000s per server                                       | Excellent sharing; high density with cgroups                   |
| Startup Time                | Near-instant; milliseconds                                                  | Instant; sub-millisecond contexts                    | Fast; microseconds for VM creation                    | Fast; 100-150ms boot                                                   | Quick; 100ms-1s                                                |
| Security for Untrusted Code | Robust kernel isolation; vulnerable to kernel bugs                          | Inadequate; context escapes possible                 | Similar to Node.js; V8 vulnerabilities                | Excellent hardware isolation                                           | Strong with namespaces; kernel-sharing risks                   |
| Supported Languages         | Any executable on host OS                                                   | JS only                                              | JS/TS                                                 | Any supported by guest OS                                              | Any via container images                                       |
| Privilege Requirements      | Unprivileged; no root needed                                                | Inherits host privileges                             | Runtime permissions; granular control                 | Requires root/KVM for hypervisor                                       | Docker needs root; Podman rootless                             |
| Network Access Control      | Fine-grained flags; allow/deny                                              | Limited; no native controls                          | Permission-based; default deny                        | Complete isolation with virtual NICs                                   | Advanced namespaces/bridges                                    |
| Filesystem Access Control   | Precise bind-mounts/read-only                                               | Weak; shares host FS                                 | Permission-based grants                               | Full guest FS isolation                                                | Volumes/binds with permissions                                 |
| Limitations                 | OS-specific; complex profiles                                               | Not secure; JS-only, easy escapes                    | Immature; shares JS flaws                             | Hardware-dependent; higher overhead                                    | Kernel-sharing risks; daemon vulns                             |
| Use Cases                   | Sandboxing AI scripts/binaries locally                                      | Evaluating AI JS snippets                            | Running AI JS/TS                                      | Secure untrusted AI code execution in serverless                       | Containerizing AI agents                                       |
