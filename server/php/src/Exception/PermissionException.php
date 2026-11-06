<?php

declare(strict_types=1);

namespace Clikgate\Exception;

/** 403: missing scope, role, feature or plan (`plan_limit_reached`, `test_link_limit_reached`, `cli_scope`, …). */
class PermissionException extends ClikgateException
{
    /** On `plan_limit_reached`, `plan_upgrade_required` and `plan_feature_unavailable`: the lowest plan that allows it. */
    public function getRequiredPlan(): ?string
    {
        $v = $this->rawValue('required_plan');

        return \is_string($v) ? $v : null;
    }

    /** On `test_link_limit_reached`: the number of active test links allowed. */
    public function getLimit(): ?int
    {
        $v = $this->rawValue('limit');

        return \is_int($v) ? $v : null;
    }
}
