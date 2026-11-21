<?php

declare(strict_types=1);

use App\AppFactory;
use App\Config;
use App\State;

require __DIR__ . '/../vendor/autoload.php';

$state = new State(getenv('SAMPLE_STATE_FILE') ?: sys_get_temp_dir() . '/clikgate-end-to-end-sample.json');
AppFactory::create(Config::fromEnvironment(), $state)['app']->run();
