import express from "express";
import cors from "cors";
import { generateAnalysis } from "./analysis.js";

const app = express();
app.use(cors());
app.use(express.json());

app.post("/analyze", async (req, res) => {
  try {
    const { symbol, timeframe, candles } = req.body;

    if (!symbol || !timeframe) {
      return res.status(400).json({ error: "Missing symbol or timeframe" });
    }

    const analysis = await generateAnalysis(symbol, timeframe, candles);
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: "Internal error", details: String(err) });
  }
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log("API running on port " + PORT);
});

