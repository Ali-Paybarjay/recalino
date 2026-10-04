/** A failed PUT can still have stored the bytes. Only the server can verify them safely. */
export async function uploadWithConfirmation(
  write: () => Promise<Pick<Response, "ok">>,
  confirmStored: () => Promise<unknown>,
  failureMessage: string,
): Promise<void> {
  try {
    if ((await write()).ok) return;
  } catch {
    // A lost response leaves the upload outcome unknown, just like a rejected repeated PUT.
  }
  try {
    const confirmation = await confirmStored();
    if (
      confirmation !== null &&
      typeof confirmation === "object" &&
      "confirmed" in confirmation &&
      confirmation.confirmed === true
    )
      return;
  } catch {
    // Keep the local original available when the server cannot verify the stored part.
  }
  throw new Error(failureMessage);
}
