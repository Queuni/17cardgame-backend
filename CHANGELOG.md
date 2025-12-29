# Changelog


## 2025-12-26
- Add proper error handling for invalid config so the app doesn't crash on startup

## 2026-01-02
- Fix incorrect type hint that was causing mypy to fail in CI

## 2026-01-03
- Fix bug where the parser would hang on malformed input

## 2026-01-04
- Improve the error recovery when the database connection is lost

## 2026-01-07
- Clean up leftover code from the previous implementation

## 2026-01-08
- Clean up unused imports and fix formatting to match the project style guide

## 2026-01-09
- Clean up the deprecated alias and point callers to the new name

## 2026-01-11
- Add validation for the config schema before applying settings

## 2026-01-15
- Add integration tests for the new export endpoint

## 2026-01-15
- Fix issue where empty input was not validated before passing to the parser

## 2026-01-20
- Adjust buffer size for the stream reader to reduce memory usage

## 2026-01-20
- Handle the case when the external service returns an empty list

## 2026-01-26
- Adjust the pool size to match the actual concurrency we need

## 2025-12-16
- Correct the timestamp format to use ISO 8601 for consistency

## 2025-12-17
- Correct the docstring to match the actual behavior of the function

## 2025-12-19
- Handle the duplicate key case by merging the values instead of failing

## 2025-12-19
- Simplify error messages so they are actionable for the end user

## 2025-12-22
- Bump the tool version and update the pre-commit hook config

## 2025-12-22
- Refactor error handling to use a custom exception hierarchy

## 2025-12-23
- Add validation for the config schema before applying settings

## 2025-12-23
- Correct the formula used for calculating the backoff delay

## 2025-12-29
- Bump the Docker base image to get the latest security patches

## 2025-12-29
- Improve the setup script to check for required tools before running
