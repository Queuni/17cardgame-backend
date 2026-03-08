import { Request, Response, NextFunction } from "express";
import { auth } from "../config/firebase.js";

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

export const verifyFirebaseToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ 
        error: "Unauthorized", 
        message: "Authorization header missing or invalid" 
      });
      return;
    }

    const token = authHeader.split(" ")[1];
    
    if (!token) {
      res.status(401).json({ 
        error: "Unauthorized", 
        message: "Token not provided" 
      });
      return;
    }

    const decoded = await auth.verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    console.error("Token verification error:", error);
    
    if (error instanceof Error) {
      res.status(401).json({ 
        error: "Unauthorized", 
        message: "Invalid or expired token",
        details: error.message 
      });
    } else {
      res.status(401).json({ 
        error: "Unauthorized", 
        message: "Token verification failed" 
      });
    }
  }
};