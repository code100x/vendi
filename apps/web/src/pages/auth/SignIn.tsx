export function SignIn() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md space-y-6 p-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Vendi</h1>
          <p className="mt-2 text-gray-600">Sign in to your account</p>
        </div>
        <div className="space-y-3">
          <a
            href="/api/v1/auth/google"
            className="flex w-full items-center justify-center gap-2 rounded-lg border bg-white px-4 py-3 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Continue with Google
          </a>
          <a
            href="/api/v1/auth/github"
            className="flex w-full items-center justify-center gap-2 rounded-lg border bg-white px-4 py-3 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Continue with GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
