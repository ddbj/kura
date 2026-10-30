import type { QueryKey } from "@tanstack/react-query"
import { QueryClient } from "@tanstack/react-query"

// The AWS SDK already retries transient failures (3 attempts) inside each
// command, so the query layer does not retry on top of that.
export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: false,
      },
      mutations: { retry: false },
    },
  })

// Refetches the queries a write to S3 has made stale. invalidateQueries alone
// is not enough: a query whose first fetch is still in flight keeps that
// fetch, which started before the write, instead of starting another, so a
// file uploaded while a folder is still loading would stay out of the list.
// Cancelling the in-flight fetch first makes the refetch one that sees the
// write.
export const refreshAfterWrite = async (queryClient: QueryClient, queryKey: QueryKey): Promise<void> => {
  await queryClient.cancelQueries({ queryKey })
  await queryClient.invalidateQueries({ queryKey })
}
