/**
 * Adapters for passing async functions to DOM event props.
 *
 * An event prop expects a handler that returns nothing. Handing it an async function makes the
 * returned promise nobody's responsibility: if the request fails, the rejection is unhandled,
 * the catch block that would have shown an error never runs, and any "busy" flag the handler
 * set stays on forever. Going through here keeps the rejection attached to something.
 */

/** Runs an async event handler and routes any failure to the component's error state. */
export function eventHandler<Event>(
  action: (event: Event) => Promise<unknown>,
  onError: (error: unknown) => void
): (event: Event) => void {
  return (event) => {
    void action(event).catch(onError);
  };
}

/** The same, for handlers invoked with arbitrary arguments rather than an event. */
export function actionHandler<Args extends unknown[]>(
  action: (...args: Args) => Promise<unknown>,
  onError: (error: unknown) => void
): (...args: Args) => void {
  return (...args) => {
    void action(...args).catch(onError);
  };
}
