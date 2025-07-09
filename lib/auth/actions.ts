"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  createUser,
  getUser,
  createUserFromSupabase,
  getUserBySupabaseId,
  updateUserSupabaseId,
} from "@/lib/db/queries";

const authFormSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export interface LoginActionState {
  status: "idle" | "in_progress" | "success" | "failed" | "invalid_data" | "migration_needed";
  message?: string;
}

export async function login(_: LoginActionState, formData: FormData): Promise<LoginActionState> {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    console.log("Attempting login for:", validatedData.email);

    // First, check if user exists in our database
    const [existingUser] = await getUser(validatedData.email);
    console.log(
      "User in database:",
      existingUser ? "Found" : "Not found",
      existingUser?.supabaseId ? "with supabaseId" : "without supabaseId"
    );

    const supabase = await createClient();

    // Check if Supabase is configured
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      console.error("Supabase environment variables not configured");
      return {
        status: "failed",
        message: "Authentication service not configured. Please check environment variables.",
      };
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: validatedData.email,
      password: validatedData.password,
    });

    if (error) {
      console.error("Supabase auth error:", error.message);
      console.error("Error code:", error.status);

      // If user doesn't exist in Supabase, check if they need migration
      if (error.message.includes("Invalid login credentials")) {
        if (existingUser && !existingUser.supabaseId) {
          console.log("User needs migration");
          return {
            status: "migration_needed",
            message:
              "This account exists from before our system migration. Please register again with the same email and a new password to migrate your account.",
          };
        }
      }

      return { status: "failed", message: error.message };
    }

    // Ensure user exists in our database with proper supabaseId mapping
    if (data.user && !data.user.is_anonymous) {
      let [internalUser] = await getUserBySupabaseId(data.user.id);

      if (!internalUser) {
        // Check if user exists by email (from before migration)
        const [existingUser] = await getUser(validatedData.email);

        if (existingUser) {
          // Update existing user with supabaseId
          await updateUserSupabaseId(validatedData.email, data.user.id);
        } else {
          // Create new internal user linked to Supabase
          await createUserFromSupabase(data.user.id, validatedData.email);
        }
      }
    }

    return { status: "success" };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: "invalid_data" };
    }

    return { status: "failed" };
  }
}

export interface RegisterActionState {
  status: "idle" | "in_progress" | "success" | "failed" | "user_exists" | "invalid_data";
}

export async function register(
  _: RegisterActionState,
  formData: FormData
): Promise<RegisterActionState> {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    // Check if user already exists in our database
    const [existingUser] = await getUser(validatedData.email);
    if (existingUser && existingUser.supabaseId) {
      return { status: "user_exists" };
    }

    const supabase = await createClient();

    const { data, error } = await supabase.auth.signUp({
      email: validatedData.email,
      password: validatedData.password,
    });

    if (error) {
      return { status: "failed" };
    }

    if (data.user && !data.user.is_anonymous) {
      // Check if this is a migration case (user exists without supabaseId)
      const [existingUser] = await getUser(validatedData.email);

      if (existingUser && !existingUser.supabaseId) {
        // Migrate existing user by linking to Supabase
        await updateUserSupabaseId(validatedData.email, data.user.id);
      } else {
        // Create new user in our database with supabaseId mapping
        await createUserFromSupabase(data.user.id, validatedData.email);
      }
    }

    return { status: "success" };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: "invalid_data" };
    }

    return { status: "failed" };
  }
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
}

export async function signInAsGuest() {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInAnonymously();

  if (error) {
    throw error;
  }

  return data;
}
