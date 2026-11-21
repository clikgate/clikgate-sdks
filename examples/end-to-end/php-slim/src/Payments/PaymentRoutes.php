<?php

declare(strict_types=1);

namespace App\Payments;

use App\Http;
use App\Users\UserStore;
use Clikgate\Clikgate;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\App;

/**
 * The app reports the payment as a Payment goal (provider and reference). Your server confirms it here, after its own
 * check with the gateway, so Clikgate counts the confirmed amount, never an amount sent from the app.
 */
final class PaymentRoutes
{
    public function __construct(private readonly UserStore $users, private readonly Clikgate $clikgate) {}

    public function register(App $app): void
    {
        $app->post('/payments/paystack/confirm', $this->confirm(...));
    }

    /**
     * Your server's own check with Paystack. Stubbed in the sample: it answers like a successful
     * `GET https://api.paystack.co/transaction/verify/{reference}` for ₦7,500, so the sample runs without a Paystack
     * account. In your app, make that request with your Paystack secret key and return the decoded JSON body.
     *
     * @return array<string, mixed>
     */
    public static function verifyWithPaystack(string $reference): array
    {
        return [
            'status' => true,
            'message' => 'Verification successful',
            'data' => [
                'status' => 'success',
                'reference' => $reference,
                'amount' => 750000, // kobo: Paystack's minor unit
                'currency' => 'NGN',
                'paid_at' => '2026-11-20T10:15:00.000Z',
                'metadata' => [],
            ],
        ];
    }

    private function confirm(Request $request, Response $response): Response
    {
        if (null === Http::signedInUser($request, $this->users)) {
            return Http::json($response, ['error' => 'not_signed_in'], 401);
        }
        $reference = Http::field($request, 'reference');
        // #region from-paystack
        $verify = self::verifyWithPaystack($reference); // your own check, with your Paystack key
        if ('success' !== ($verify['data']['status'] ?? null)) {
            return Http::json($response, ['error' => 'payment_not_successful'], 402);
        }
        // ...give the customer what they paid for, then pass Paystack's answer on. Only the reference, status, amount,
        // currency, time and cg_click_id are sent: never customer details.
        $this->clikgate->payments->fromPaystack($verify, ['goal' => 'order_paid']);
        // #endregion

        return Http::json($response, ['status' => 'paid', 'reference' => $reference]);
    }
}
