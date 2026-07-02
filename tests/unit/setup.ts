import "@testing-library/jest-dom/vitest"

import { cleanup } from "@testing-library/react"
import { afterAll, afterEach, beforeAll } from "vitest"

import { server } from "./mocks/server"

// jsdom's Blob lacks stream() (browsers have it); lib-storage needs it to
// chunk File bodies.
if (typeof Blob.prototype.stream !== "function") {
  Blob.prototype.stream = function (this: Blob) {
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      start: async (controller) => {
        controller.enqueue(new Uint8Array(await this.arrayBuffer()))
        controller.close()
      },
    })
  }
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))

afterEach(() => {
  cleanup()
  server.resetHandlers()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterAll(() => server.close())
