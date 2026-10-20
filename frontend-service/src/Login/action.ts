import { redirect } from "react-router";
import { InvalidCredentialsError, signIn } from "../auth";
import { safeRedirect } from "./loader";

export const loginAction = async ({ request }: { request: Request }) => {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  try {
    await signIn(email, password);
    return redirect(safeRedirect(formData.get("redirectTo")));
  } catch (error) {
    if (error instanceof InvalidCredentialsError) return { error: error.message };
    // fetch rejects with a TypeError when Cognito can't be reached.
    if (error instanceof TypeError) {
      return { error: "Can't reach the sign-in service. Try again." };
    }
    return { error: (error as Error).message };
  }
};
