package com.example.clikgate;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * The backend of a mobile app, with Clikgate added: identity at sign-in, server goals, payment
 * confirmations, webhooks and referral rewards. The Clikgate starter creates the {@code Clikgate} bean.
 */
@SpringBootApplication
public class SampleApplication {

  public static void main(String[] args) {
    SpringApplication.run(SampleApplication.class, args);
  }
}
