"use client";

import { ChevronUp } from "lucide-react";
import Image from "next/image";
import { useAuth } from "./auth-provider";
import { useTheme } from "next-themes";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useRouter } from "next/navigation";
import { toast } from "./toast";
import { LoaderIcon } from "./icons";

export function SidebarUserNav() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const { setTheme, resolvedTheme } = useTheme();

  const isGuest = user?.is_anonymous || false;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {loading ? (
              <SidebarMenuButton className="data-[state=open]:bg-sidebar-accent bg-background data-[state=open]:text-sidebar-accent-foreground h-10 justify-between">
                <div className="flex flex-row gap-2">
                  <div className="size-6 bg-zinc-500/30 rounded-full animate-pulse" />
                  <span className="bg-zinc-500/30 text-transparent rounded-md animate-pulse">
                    Loading auth status
                  </span>
                </div>
                <div className="animate-spin text-zinc-500">
                  <LoaderIcon />
                </div>
              </SidebarMenuButton>
            ) : user ? (
              <SidebarMenuButton
                data-testid="user-nav-button"
                className="data-[state=open]:bg-sidebar-accent bg-background data-[state=open]:text-sidebar-accent-foreground h-10"
              >
                <Image
                  src={`https://avatar.vercel.sh/${user.email || "guest"}`}
                  alt={user.email ?? "User Avatar"}
                  width={24}
                  height={24}
                  className="rounded-full"
                />
                <span data-testid="user-email" className="truncate">
                  {isGuest ? "Guest" : user?.email}
                </span>
                <ChevronUp className="ml-auto" />
              </SidebarMenuButton>
            ) : null}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            data-testid="user-nav-menu"
            side="top"
            className="w-[--radix-popper-anchor-width]"
          >
            <DropdownMenuItem
              data-testid="user-nav-item-theme"
              className="cursor-pointer"
              onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            >
              {`Toggle ${resolvedTheme === "light" ? "dark" : "light"} mode`}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild data-testid="user-nav-item-auth">
              <button
                type="button"
                className="w-full cursor-pointer"
                onClick={async () => {
                  if (loading) {
                    toast({
                      type: "error",
                      description: "Checking authentication status, please try again!",
                    });

                    return;
                  }

                  if (isGuest) {
                    router.push("/login");
                  } else {
                    await signOut();
                    window.location.reload();
                  }
                }}
              >
                {isGuest ? "Login to your account" : "Sign out"}
              </button>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
