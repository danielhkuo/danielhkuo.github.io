<!-- src/components/Counter.svelte -->
<div class="my-6 flex items-center gap-4 rounded-lg border p-4">
    <p class="text-lg font-medium">
      This is an interactive Svelte component!
    </p>
    <div class="flex items-center gap-2">
      <button
        class="rounded-md bg-indigo-600 px-3 py-1 text-white transition hover:bg-indigo-500"
        on:click={() => count--}>-</button
      >
      <span class="w-8 text-center text-xl font-bold">{count}</span>
      <button
        class="rounded-md bg-indigo-600 px-3 py-1 text-white transition hover:bg-indigo-500"
        on:click={() => count++}>+</button
      >
    </div>
  </div>
  
  <script>
    let count = 0;
  </script>