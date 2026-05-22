<script setup>
import { RouterView } from 'vue-router'
</script>

<template>
  <div class="app-stage">
    <RouterView />
  </div>
</template>

<style>
.app-stage {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.app-stage > * {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
