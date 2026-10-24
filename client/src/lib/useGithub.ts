import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getApi } from "@/lib/api";
import type { GithubStatus, ScanApi } from "@/lib/types";

const KEY = ["github"];

export const useGithub = () =>
  useQuery({ queryKey: KEY, queryFn: async () => (await getApi()).getGithub() });

/** Runs a GitHub integration call and writes the returned status straight into the cache. */
export function useGithubAction<A extends unknown[]>(
  run: (api: ScanApi, ...a: A) => Promise<GithubStatus>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: A) => run(await getApi(), ...a),
    onSuccess: (status) => {
      // GitHub App flow: finish on github.com, which redirects back here when done.
      if (status.install_url) window.location.assign(status.install_url);
      else qc.setQueryData(KEY, status);
    },
  });
}
