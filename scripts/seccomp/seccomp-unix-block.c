#include <errno.h>
#include <fcntl.h>
#include <seccomp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

int main(int argc, char *argv[]) {
  scmp_filter_ctx ctx;
  int rc;

  if (argc != 2) {
    fprintf(stderr, "Usage: %s <output-file>\n", argv[0]);
    return 1;
  }

  const char *output_file = argv[1];

  ctx = seccomp_init(SCMP_ACT_ALLOW);
  if (ctx == NULL) {
    fprintf(stderr, "Error: Failed to initialize seccomp context\n");
    return 1;
  }

  rc = seccomp_rule_add(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(socket), 1,
                        SCMP_A0(SCMP_CMP_EQ, AF_UNIX));
  if (rc < 0) {
    fprintf(stderr, "Error: Failed to add seccomp rule: %s\n", strerror(-rc));
    seccomp_release(ctx);
    return 1;
  }

  int fd = open(output_file, O_CREAT | O_WRONLY | O_TRUNC, 0600);
  if (fd < 0) {
    fprintf(stderr, "Error: Failed to open output file: %s\n", strerror(errno));
    seccomp_release(ctx);
    return 1;
  }

  rc = seccomp_export_bpf(ctx, fd);
  if (rc < 0) {
    fprintf(stderr, "Error: Failed to export seccomp filter: %s\n",
            strerror(-rc));
    close(fd);
    seccomp_release(ctx);
    return 1;
  }

  close(fd);
  seccomp_release(ctx);

  return 0;
}
