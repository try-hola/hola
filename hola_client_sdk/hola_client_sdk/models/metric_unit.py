from enum import Enum


class MetricUnit(str, Enum):
    BYTES = "bytes"
    BYTES_PER_SECOND = "bytes_per_second"
    COUNT = "count"
    MILLISECONDS = "milliseconds"
    PERCENT = "percent"
    REQUESTS_PER_SECOND = "requests_per_second"
    SECONDS = "seconds"

    def __str__(self) -> str:
        return str(self.value)
