<!-- app/pages/goals.vue — stub, coming in this update -->
<template>
  <div class="stub-page">
    <div class="card stub-page__card">
      <div class="stub-page__icon" aria-hidden="true">
        <!-- target icon -->
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
          stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <circle cx="12" cy="12" r="6"/>
          <circle cx="12" cy="12" r="2"/>
        </svg>
      </div>
      <h1 class="stub-page__title">Goals</h1>
      <p class="stub-page__body">Emergency fund milestones and card payoff tracking in detail. Coming in this update.</p>
    </div>
  </div>
</template>

<style scoped>
.stub-page {
  padding: 24px 16px;
  max-width: 480px;
  margin: 0 auto;
}

.stub-page__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 40px 24px;
  gap: 12px;
}

.stub-page__icon {
  color: var(--primary);
  opacity: .6;
}

.stub-page__title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  margin: 0;
  letter-spacing: -0.01em;
}

.stub-page__body {
  font-size: 14px;
  color: var(--text-muted);
  margin: 0;
  line-height: 1.5;
  max-width: 280px;
}
</style>
