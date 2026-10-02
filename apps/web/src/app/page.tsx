import { redirect } from "next/navigation";
import { getLearner } from "../server/auth/learner";
import { safeReturnPath } from "../server/auth/return-path";
import { legalValues } from "../server/legal";
import { LegalDocument } from "../ui/components/LegalDocument";
import { SignIn } from "./SignIn";

export const dynamic = "force-dynamic";

type WelcomeProps = {
  searchParams: Promise<{ next?: string; error?: string }>;
};

/** A1 — the start page: sign in, or go on to setup or Today when already signed in. */
export default async function WelcomePage({ searchParams }: WelcomeProps) {
  const params = await searchParams;
  const learner = await getLearner();
  if (learner !== null) {
    redirect(learner.state.setupComplete ? safeReturnPath(params.next) : "/setup");
  }
  const values = legalValues();
  return (
    <SignIn
      failed={params.error === "signin"}
      next={safeReturnPath(params.next, "")}
      terms={<LegalDocument id="terms" values={values} />}
      privacy={<LegalDocument id="privacy" values={values} />}
    />
  );
}
