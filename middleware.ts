import { authMiddleware } from "@clerk/nextjs";
import { NextResponse } from "next/server";

export default authMiddleware({
  publicRoutes: ["/", "/sign-in", "/sign-up"],
  async afterAuth(auth, req) {
    const url = req.nextUrl;
    const hostname = url.hostname;

    // Custom domain handling
    if (hostname !== "localhost" && !hostname.includes("vercel.app")) {
      // TODO: Later we'll lookup domain → organization
      console.log("Custom domain detected:", hostname);
    }

    return NextResponse.next();
  },
});

export const config = {
  matcher: ['/((?!.+\\.[\\w]+$|_next).*)', '/', '/(api|trpc)(.*)'],
};