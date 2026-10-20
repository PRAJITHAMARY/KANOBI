import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import LoadingScreen from "../components/LoadingScreen";
import FormBanner from "../components/FormBanner";

export default function LoginPage() {
  const navigation = useNavigation();
  const { expired, redirectTo } = useLoaderData() as { expired: boolean; redirectTo: string };
  const actionData = useActionData() as { error?: string } | undefined;

  return navigation.state == "loading" || navigation.state == "submitting" ? (
    <LoadingScreen />
  ) : (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <Form
        method="post"
        className="p-6 rounded-xl shadow-md w-80 bg-gray-600 text-white"
      >
        <h1 className="text-xl font-bold mb-4">Sign in</h1>
        {expired && !actionData?.error && (
          <p role="status" className="mb-3 text-sm text-gray-200">
            Your session has expired. Sign in again.
          </p>
        )}
        <FormBanner message={actionData?.error} />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <label className="block text-sm mb-1" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          name="email"
          autoComplete="email"
          required
          className="border p-2 rounded w-full mb-3"
        />
        <label className="block text-sm mb-1" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          className="border p-2 rounded w-full mb-4"
        />
        <button
          type="submit"
          className="bg-blue-500 p-2 rounded w-full hover:bg-blue-600"
        >
          Sign in
        </button>
      </Form>
    </div>
  );
}
