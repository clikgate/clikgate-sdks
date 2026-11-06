package com.clikgate;

/**
 * One event of {@code goals().sendBatch}: the goal key and its options.
 *
 * <pre>{@code
 * GoalBatchEvent.of("order_paid", Goal.builder().reference("ORD-1001").value("1500.50").build());
 * }</pre>
 */
public final class GoalBatchEvent {
  final String goal;
  final Goal options;

  private GoalBatchEvent(String goal, Goal options) {
    this.goal = goal;
    this.options = options;
  }

  public static GoalBatchEvent of(String goal, Goal options) {
    return new GoalBatchEvent(goal, options);
  }

  public String getGoal() {
    return goal;
  }

  public Goal getOptions() {
    return options;
  }
}
