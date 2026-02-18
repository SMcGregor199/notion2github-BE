import express from "express";
import type {Express} from 'express'
const app: Express = express();

const PORT = 8000;

app.get("/", (req, res) => {
  res.json({message: "We're on Railway"});
});


app.listen(PORT, ():void => {
  console.log(`Listening on port ${PORT}`);
});
