<script lang="ts">
  interface Props {
    status: string;
    dirty?: boolean;
    projectPath?: string | null;
    projectName?: string;
  }

  let {
    status,
    dirty = false,
    projectPath = null,
    projectName = "Untitled",
  }: Props = $props();

  const label = $derived(projectPath ? projectPath.split(/[/\\]/).pop() : projectName);
</script>

<div class="status-line" role="status">
  <span class="project">
    <strong>{label}</strong>
    {#if dirty}
      <span class="dirty" title="Unsaved changes">•</span>
    {/if}
  </span>
  <span class="sep">·</span>
  <span class="status">{status}</span>
</div>

<style>
  .status-line {
    min-height: 1.35rem;
    font-size: 0.85rem;
    color: var(--muted);
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35rem;
    padding: 0 0.15rem;
  }

  .project strong {
    color: var(--text);
    font-weight: 600;
  }

  .dirty {
    color: var(--warn);
    font-weight: 700;
    margin-left: 0.15rem;
  }

  .sep {
    opacity: 0.45;
  }

  .status {
    color: var(--muted);
  }
</style>
