import express from "express";
import mapsRouter from "./route/maps.js";

const app = express();

app.use(express.json());
app.use("/api/maps", mapsRouter);

app.listen(3001, () => {
  console.log("Server rodando na porta 3001");
});
