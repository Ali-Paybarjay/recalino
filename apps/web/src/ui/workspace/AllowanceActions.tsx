import type { AutomaticLearningStatus } from "./automatic-learning";
import { type AllowanceBlock, allowanceBlock } from "./automatic-learning-recovery";
import { Actions, Button, LinkButton } from "./primitives";

/** The request a short or missing learner allowance names (FR-QUOTA-007). */
export function AllowanceRequest({ block }: { block: AllowanceBlock | null | undefined }) {
  if (block !== "shortage" && block !== "none") return null;
  return (
    <>
      <LinkButton href="/help/new">
        {block === "none" ? "Ask the pilot operator" : "Ask for more allowance"}
      </LinkButton>
      <LinkButton secondary href="/me/quota">
        Review allowance
      </LinkButton>
    </>
  );
}

/**
 * The next step an allowance stop names when this device holds no upload receipt: the retry once
 * the allowance covers the class (FR-QUOTA-007 rule 5), otherwise the request for more.
 */
export function AllowanceActions({
  status,
  busy,
  onRetry,
}: {
  status: AutomaticLearningStatus | null;
  busy: boolean;
  onRetry(): void;
}) {
  const block = status?.state === "blocked" ? allowanceBlock(status) : null;
  if (!block) return null;
  return (
    <Actions>
      {block === "covered" ? (
        <Button disabled={busy} onClick={onRetry}>
          Retry processing
        </Button>
      ) : (
        <AllowanceRequest block={block} />
      )}
    </Actions>
  );
}
