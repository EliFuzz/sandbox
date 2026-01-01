#include <errno.h>
#include <fcntl.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <unistd.h>

#ifndef PR_SET_NO_NEW_PRIVS
#define PR_SET_NO_NEW_PRIVS 38
#endif

#ifndef SECCOMP_MODE_FILTER
#define SECCOMP_MODE_FILTER 2
#endif

#define MAX_FILTER_SIZE 4096

int main(int argc, char *argv[], char *envp[]) {
  (void)envp;
  if (argc < 3) {
    fprintf(stderr, "Usage: %s <filter.bpf> <command> [args...]\n", argv[0]);
    return 1;
  }

  const char *filter_path = argv[1];
  char **command_argv = &argv[2];

  int fd = open(filter_path, O_RDONLY);
  if (fd < 0) {
    perror("Failed to open BPF filter file");
    return 1;
  }

  unsigned char filter_bytes[MAX_FILTER_SIZE];
  ssize_t filter_size = read(fd, filter_bytes, MAX_FILTER_SIZE);
  close(fd);

  if (filter_size < 0) {
    perror("Failed to read BPF filter");
    return 1;
  }
  if (filter_size == 0) {
    fprintf(stderr, "BPF filter file is empty\n");
    return 1;
  }
  if (filter_size % 8 != 0) {
    fprintf(stderr, "Invalid BPF filter size: %zd\n", filter_size);
    return 1;
  }

  unsigned short filter_len = filter_size / 8;
  struct sock_filter *filter = (struct sock_filter *)filter_bytes;
  
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
    perror("prctl(PR_SET_NO_NEW_PRIVS) failed");
    return 1;
  }
  
  struct sock_fprog prog = { .len = filter_len, .filter = filter };
  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog) != 0) {
    perror("prctl(PR_SET_SECCOMP) failed");
    return 1;
  }

  execvp(command_argv[0], command_argv);

  perror("execvp failed");
  return 1;
}
