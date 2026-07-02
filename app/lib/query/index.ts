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
