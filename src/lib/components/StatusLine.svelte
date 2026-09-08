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

<!-- Hand-typed near-copy of STRIP: deliberately uses `gap-2 px-3` rather than STRIP's
     `gap-1 px-2`. -->
<div
  class="flex h-7 shrink-0 items-center gap-2 border-t border-line bg-panel px-3 text-[11px] text-muted"
  role="status"
>
  <span class="flex shrink-0 items-center gap-1">
    <FileText size={14} strokeWidth={2} class="opacity-75" aria-hidden="true" />
    <strong class="font-medium text-text">{label}</strong>
    {#if dirty}
      <span class="font-bold text-accent" title="Unsaved changes">•</span>
    {/if}
  </span>
  <span class="opacity-45" aria-hidden="true">·</span>
  <span class="flex min-w-0 items-center gap-1 {isError ? 'text-danger' : ''}">
    {#if isError}
      <CircleAlert size={14} strokeWidth={2} class="shrink-0" aria-hidden="true" />
    {:else}
      <Info size={14} strokeWidth={2} class="shrink-0 opacity-80" aria-hidden="true" />
    {/if}
    <span class="truncate">{status}</span>
  </span>
  {#if showHint}
    <span class="opacity-45" aria-hidden="true">·</span>
    <span class="flex min-w-0 flex-1 items-center gap-1" title={hint}>
      <Lightbulb size={14} strokeWidth={2} class="shrink-0 text-accent" aria-hidden="true" />
      <span class="truncate">{hint}</span>
    </span>
  {/if}
</div>
