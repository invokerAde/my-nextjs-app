"use client";
import { Button } from "@/components/ui/button";
import { signOutUser } from "@/lib/actions/user.actions";

const SignOutButton = () => {
  return (
    <Button
      className="w-full py-4 px-2 h-4 justify-start"
      variant="ghost"
      onClick={() => signOutUser()}
    >
      Sign Out
    </Button>
  );
};

export default SignOutButton;
