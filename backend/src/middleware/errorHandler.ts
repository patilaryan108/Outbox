import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({ error: "Invalid request.", details: error.flatten() });
    return;
  }
  if (error instanceof Error && error.message === "The selected sender is not configured.") {
    res.status(400).json({ error: error.message });
    return;
  }
  console.error("Unhandled API error.", error);
  res.status(500).json({ error: "An unexpected server error occurred." });
};
