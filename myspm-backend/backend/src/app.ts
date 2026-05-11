import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import router from "./routes";

const app: Express = express();

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://localhost:4001",
  "http://localhost:8082",
  "http://localhost:8081",
  "https://tmyspm.amastsales-sandbox.com",
  "http://tmyspm.amastsales-sandbox.com",
]);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, allowedOrigins.has(origin));
    },
  }),
);
app.use(express.json({
  limit: "50mb",
}));
app.use(express.urlencoded({ extended: true }));

function payloadForLog(req: Request): unknown {
  if (req.method === "GET" || req.method === "HEAD") {
    return Object.keys(req.query).length > 0 ? req.query : null;
  }
  const body = req.body;
  if (body == null || body === "") return null;
  if (typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0) {
    return null;
  }
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    const copy = { ...(body as Record<string, unknown>) };
    for (const key of ["password", "newPassword", "resetToken", "token"]) {
      if (key in copy) copy[key] = "[redacted]";
    }
    return copy;
  }
  return body;
}

app.use((req: Request, res: Response, next: NextFunction) => {
  const url = req.originalUrl ?? req.url;
  const payload = payloadForLog(req);

  res.on("finish", () => {
    console.log(
      JSON.stringify({
        method: req.method,
        url,
        payload,
        status: res.statusCode,
      }),
    );
  });

  next();
});

// Debug endpoint to check body parsing
app.post("/api/debug", (req: Request, res: Response) => {
  console.log("DEBUG: body =", req.body);
  res.json({ body: req.body, bodyType: typeof req.body });
});

app.get("/", (req: Request, res: Response) => {
  res.json({ message: 'Connected to MySPM API' });
});

app.use("/api", router);

export default app;
