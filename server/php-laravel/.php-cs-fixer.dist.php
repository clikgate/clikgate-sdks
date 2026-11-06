<?php

declare(strict_types=1);

$finder = (new PhpCsFixer\Finder())->in([__DIR__.'/src', __DIR__.'/tests', __DIR__.'/config', __DIR__.'/examples']);

return (new PhpCsFixer\Config())
    ->setRiskyAllowed(true)
    ->setRules([
        '@PER-CS2.0' => true,
        '@PHP81Migration' => true,
        'declare_strict_types' => true,
        'strict_comparison' => true,
        'no_unused_imports' => true,
        'ordered_imports' => true,
    ])
    ->setFinder($finder);
