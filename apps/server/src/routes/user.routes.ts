import { Router } from "express";
import { prisma } from "../lib/prisma";
import { encrypt } from "../lib/crypto";

const router = Router();

// PUT /users/api-key — store an encrypted API key for the current user
router.put("/api-key", async (req, res) => {
  try {
    const userId = res.locals.user.id;
    const { apiKey } = req.body;

    if (!apiKey || typeof apiKey !== "string") {
      return res.status(400).json({ error: "apiKey is required" });
    }

    if (!apiKey.startsWith("sk-ant-")) {
      return res
        .status(400)
        .json({ error: "Invalid API key format. Must start with sk-ant-" });
    }

    const { encrypted, iv } = encrypt(apiKey);

    await prisma.user.update({
      where: { id: userId },
      data: {
        encryptedApiKey: encrypted,
        apiKeyIv: iv,
      },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error("Error storing API key:", error);
    return res.status(500).json({ error: "Failed to store API key" });
  }
});

// DELETE /users/api-key — remove the stored API key for the current user
router.delete("/api-key", async (req, res) => {
  try {
    const userId = res.locals.user.id;

    await prisma.user.update({
      where: { id: userId },
      data: {
        encryptedApiKey: null,
        apiKeyIv: null,
      },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error("Error removing API key:", error);
    return res.status(500).json({ error: "Failed to remove API key" });
  }
});

// GET /users/api-key/status — check whether the current user has an API key stored
router.get("/api-key/status", async (req, res) => {
  try {
    const userId = res.locals.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { encryptedApiKey: true },
    });

    return res.json({ hasApiKey: !!user?.encryptedApiKey });
  } catch (error) {
    console.error("Error checking API key status:", error);
    return res.status(500).json({ error: "Failed to check API key status" });
  }
});

export default router;
