<script lang="ts">
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import FileText from "@lucide/svelte/icons/file-text";
  import Info from "@lucide/svelte/icons/info";
  import Lightbulb from "@lucide/svelte/icons/lightbulb";

  interface Props {
    status: string;
    /** Contextual tip (selection, tools). Hidden when status looks like an error. */
    hint?: string | null;
    dirty?: boolean;
    projectPath?: string | null;
    projectName?: string;
  }

  let {
    status,
    hint = null,
    dirty = false,
    projectPath = null,
    projectName = "Untitled",
  }: Props = $props();

  const label = $derived(projectPath ? projectPath.split(/[/\\]/).pop() : projectName);
  const isError = $derived(
    /fail|error|missing|not found|require|blocked/i.test(status) && status.trim().length > 0,
  );
  const showHint = $derived(!!hint && !isError && hint.trim().length > 0);
</script>

<div class="status-line" role="status">
  <span class="project">
    <FileText size={14} strokeWidth={2} class="file-icon" aria-hidden="true" />
    <strong>{label}</strong>
    {#if dirty}
      <span class="dirty" title="Unsaved changes">•</span>
    {/if}
  </span>
  <span class="sep">·</span>
  <span class="status" class:error={isError}>
    {#if isError}
      <CircleAlert size={15} strokeWidth={2} aria-hidden="true" />
    {:else}
      <Info size={15} strokeWidth={2} class="info-icon" aria-hidden="true" />
    {/if}
    <span class="status-text">{status}</span>
  </span>
  {#if showHint}
    <span class="sep">·</span>
    <span class="hint" title={hint}>
      <Lightbulb size={14} strokeWidth={2} aria-hidden="true" />
      <span class="hint-text">{hint}</span>
    </span>
  {/if}
</div>

<style>
  .status-line {
    min-height: 1.4rem;
    font-size: 0.85rem;
    color: var(--muted);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    padding: 0 0.15rem;
    min-width: 0;
  }

  .project {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    flex-shrink: 0;
  }

  .project :global(.file-icon) {
    flex-shrink: 0;
    opacity: 0.75;
  }

  .project strong {
    color: var(--text);
    font-weight: 600;
  }

  .dirty {
    color: var(--warn);
    font-weight: 700;
  }

  .sep {
    opacity: 0.45;
    flex-shrink: 0;
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--muted);
    min-width: 0;
  }

  .status.error {
    color: var(--danger);
  }

  .status :global(.info-icon) {
    opacity: 0.8;
    flex-shrink: 0;
  }

  .status-text {
    min-width: 0;
  }

  .hint {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--muted);
    opacity: 0.92;
    min-width: 0;
    flex: 1 1 12rem;
  }

  .hint :global(svg) {
    flex-shrink: 0;
    opacity: 0.75;
    color: var(--accent);
  }

  .hint-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
