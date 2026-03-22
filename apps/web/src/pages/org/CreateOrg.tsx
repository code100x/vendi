import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { createOrgSchema, type CreateOrgInput } from "@vendi/shared";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import type { ZodError } from "zod";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function CreateOrg() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!slugManuallyEdited) {
      setSlug(slugify(name));
    }
  }, [name, slugManuallyEdited]);

  const createMutation = useMutation({
    mutationFn: async (input: CreateOrgInput) => {
      const { data } = await api.post("/orgs", input);
      return data;
    },
    onSuccess: (data) => {
      toast.success("Organization created successfully!");
      navigate(`/orgs/${data.id}`);
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        "Failed to create organization";
      toast.error(message);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    const input = { name: name.trim(), slug: slug.trim() };

    try {
      createOrgSchema.parse(input);
    } catch (err) {
      const zodError = err as ZodError;
      const fieldErrors: Record<string, string> = {};
      for (const issue of zodError.errors) {
        const field = issue.path[0] as string;
        fieldErrors[field] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    createMutation.mutate(input);
  }

  return (
    <div className="max-w-lg mx-auto">
      <Link
        to="/orgs"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Organizations
      </Link>

      <div className="rounded-xl border bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold text-gray-900 mb-1">
          Create Organization
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          Set up a new organization for your team.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-gray-700 mb-1.5"
            >
              Organization Name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Inc."
              className={`rounded-lg border px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-gray-900 ${
                errors.name ? "border-red-400" : ""
              }`}
            />
            {errors.name && (
              <p className="mt-1 text-xs text-red-600">{errors.name}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="slug"
              className="block text-sm font-medium text-gray-700 mb-1.5"
            >
              Slug
            </label>
            <div className="flex items-center">
              <span className="inline-flex items-center rounded-l-lg border border-r-0 bg-gray-50 px-3 py-2 text-sm text-gray-500">
                /
              </span>
              <input
                id="slug"
                type="text"
                value={slug}
                onChange={(e) => {
                  setSlugManuallyEdited(true);
                  setSlug(e.target.value);
                }}
                placeholder="acme-inc"
                className={`rounded-r-lg border px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-gray-900 ${
                  errors.slug ? "border-red-400" : ""
                }`}
              />
            </div>
            {errors.slug ? (
              <p className="mt-1 text-xs text-red-600">{errors.slug}</p>
            ) : (
              <p className="mt-1 text-xs text-gray-400">
                Only lowercase letters, numbers, and hyphens
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Create Organization
            </button>
            <Link
              to="/orgs"
              className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50 transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
