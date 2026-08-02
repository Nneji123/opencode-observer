import type { Plugin } from "@opencode-ai/plugin"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"

const SYSTEM_PROMPT = [
  "## Image Reading",
  "",
  "This model has no vision capability and cannot read images directly.",
  "- Use the @observer sub-agent to read any image referenced in the conversation.",
  "- When a message contains `[Image saved to: <path>]`, call @observer and ask it to read the image file at that exact path. Tell it what you need from the image and why (the task at hand, what to look for).",
  "- Wait for @observer's report before acting on the image's contents.",
].join("\n")

export default (async ({ client, directory }) => {
  const imageDir = path.join(os.tmpdir(), "opencode-observer")
  const capabilityCache = new Map<string, boolean>()

  async function canModelSeeImages(model?: { providerID: string; modelID: string }) {
    if (!model) return false
    const key = `${model.providerID}/${model.modelID}`
    if (capabilityCache.has(key)) return capabilityCache.get(key)!

    try {
      const res = await client.config.providers({ query: { directory } })
      for (const provider of res.data?.providers ?? []) {
        for (const [modelID, info] of Object.entries(provider.models ?? {})) {
          capabilityCache.set(
            `${provider.id}/${modelID}`,
            Boolean(info.capabilities?.attachment && info.capabilities?.input?.image),
          )
        }
      }
    } catch {
      // leave whatever is cached (possibly nothing) and fall through
    }

    return capabilityCache.get(key) ?? false
  }

  return {
    "experimental.chat.system.transform": async (input, output) => {
      const caps = input.model?.capabilities
      const canSeeImages = Boolean(caps?.attachment && caps?.input?.image)
      if (canSeeImages) return
      output.system.push(SYSTEM_PROMPT)
    },

    "chat.message": async (input, output) => {
      // Only reroute images through @observer for models that can't see them
      // natively. A multimodal model must keep receiving the raw image part.
      if (await canModelSeeImages(input.model)) return

      const sessionDir = path.join(imageDir, input.sessionID)
      let ensured = false
      const nextParts = []

      for (const part of output.parts) {
        if (part.type !== "file" || !part.mime?.startsWith("image/")) {
          nextParts.push(part)
          continue
        }

        let filePath: string | null = null

        if (part.url?.startsWith("data:")) {
          const match = /^data:[^;]+;base64,([\s\S]+)$/.exec(part.url)
          if (match) {
            if (!ensured) {
              await fs.mkdir(sessionDir, { recursive: true })
              ensured = true
            }
            const ext = (part.mime.split("/")[1] ?? "png").split("+")[0]
            const safeName = part.filename?.replace(/[^\w.-]/g, "_")
            filePath = path.join(sessionDir, safeName || `${part.id}.${ext}`)
            await fs.writeFile(filePath, Buffer.from(match[1], "base64"))
          }
        } else if (part.url?.startsWith("file://")) {
          filePath = new URL(part.url).pathname
        }

        if (!filePath) {
          nextParts.push(part)
          continue
        }

        nextParts.push({
          id: part.id,
          sessionID: part.sessionID,
          messageID: part.messageID,
          type: "text",
          text: `[Image saved to: ${filePath}]`,
        })
      }

      // Mutate the array in place rather than reassigning output.parts —
      // some call sites read the original array reference after this hook
      // resolves, so a reassignment can silently be dropped.
      output.parts.length = 0
      output.parts.push(...nextParts)
    },
  }
}) satisfies Plugin
