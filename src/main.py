# main


# Fix the off-by-one error in the date range iterator

# Refactor the client to use async context manager for the session

# Adjust log level for noisy messages that were filling the logs

# Correct the docstring to match the actual behavior of the function

# Clean up duplicate logic between the sync and async code paths

# Implement a simple health check endpoint for the load balancer

# Support optional config file path via env var for easier deployment

# Bump the library version and pin the dependency in requirements

# Add integration test that covers the full flow from request to response

# Simplify the config merge logic so overrides are predictable

# Remove the feature flag now that the feature is fully rolled out

# Improve error message when the required env var is not set

# Clean up the formatting and run the linter on the changed files

# Clean up the deprecated alias and point callers to the new name

# Refactor utils to use a single source of truth for default values

# Refactor the data layer to separate read and write paths

# Clean up the test fixtures and move shared data to a single file

# Support both YAML and JSON config formats for flexibility

# Adjust the batch size to reduce memory usage on large inputs

# Implement proper backoff with jitter for the retry logic

# Fix the encoding issue when reading config files with non-ASCII

# Implement a simple metrics endpoint for Prometheus scraping

# Fix issue where empty input was not validated before passing to the parser

# Add a note in the README about the breaking change in 2.0

# Fix the encoding issue when reading config files with non-ASCII

# Simplify the config validation by using a declarative schema

# Improve logging so we can trace requests through the pipeline in production

# Improve the CLI help text so it's clear how to use each option

# Bump the Docker base image to get the latest security patches

# Fix incorrect type hint that was causing mypy to fail in CI

# Improve error message when the required env var is not set

# Correct the default path used when no config file is specified

# Add a comment explaining why we disable the linter on this line

# Adjust the threshold so we only log when it's actually an issue

# Support passing options through the config file as well as CLI
