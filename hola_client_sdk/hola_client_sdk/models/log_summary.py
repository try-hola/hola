import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.log_summary_entries_by_level import LogSummaryEntriesByLevel
    from ..models.log_summary_entries_by_source import LogSummaryEntriesBySource


T = TypeVar("T", bound="LogSummary")


@_attrs_define
class LogSummary:
    """Summary statistics for logs.

    Attributes:
        total_entries (int): Total number of log entries
        entries_by_level (LogSummaryEntriesByLevel): Count of entries by log level
        entries_by_source (LogSummaryEntriesBySource): Count of entries by source
        size_bytes (int): Total size of log data in bytes
        earliest_entry (Union[None, Unset, datetime.datetime]): Timestamp of earliest log entry
        latest_entry (Union[None, Unset, datetime.datetime]): Timestamp of latest log entry
    """

    total_entries: int
    entries_by_level: "LogSummaryEntriesByLevel"
    entries_by_source: "LogSummaryEntriesBySource"
    size_bytes: int
    earliest_entry: Union[None, Unset, datetime.datetime] = UNSET
    latest_entry: Union[None, Unset, datetime.datetime] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        total_entries = self.total_entries

        entries_by_level = self.entries_by_level.to_dict()

        entries_by_source = self.entries_by_source.to_dict()

        size_bytes = self.size_bytes

        earliest_entry: Union[None, Unset, str]
        if isinstance(self.earliest_entry, Unset):
            earliest_entry = UNSET
        elif isinstance(self.earliest_entry, datetime.datetime):
            earliest_entry = self.earliest_entry.isoformat()
        else:
            earliest_entry = self.earliest_entry

        latest_entry: Union[None, Unset, str]
        if isinstance(self.latest_entry, Unset):
            latest_entry = UNSET
        elif isinstance(self.latest_entry, datetime.datetime):
            latest_entry = self.latest_entry.isoformat()
        else:
            latest_entry = self.latest_entry

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "total_entries": total_entries,
                "entries_by_level": entries_by_level,
                "entries_by_source": entries_by_source,
                "size_bytes": size_bytes,
            }
        )
        if earliest_entry is not UNSET:
            field_dict["earliest_entry"] = earliest_entry
        if latest_entry is not UNSET:
            field_dict["latest_entry"] = latest_entry

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.log_summary_entries_by_level import LogSummaryEntriesByLevel
        from ..models.log_summary_entries_by_source import LogSummaryEntriesBySource

        d = dict(src_dict)
        total_entries = d.pop("total_entries")

        entries_by_level = LogSummaryEntriesByLevel.from_dict(d.pop("entries_by_level"))

        entries_by_source = LogSummaryEntriesBySource.from_dict(d.pop("entries_by_source"))

        size_bytes = d.pop("size_bytes")

        def _parse_earliest_entry(data: object) -> Union[None, Unset, datetime.datetime]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                earliest_entry_type_0 = isoparse(data)

                return earliest_entry_type_0
            except:  # noqa: E722
                pass
            return cast(Union[None, Unset, datetime.datetime], data)

        earliest_entry = _parse_earliest_entry(d.pop("earliest_entry", UNSET))

        def _parse_latest_entry(data: object) -> Union[None, Unset, datetime.datetime]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                latest_entry_type_0 = isoparse(data)

                return latest_entry_type_0
            except:  # noqa: E722
                pass
            return cast(Union[None, Unset, datetime.datetime], data)

        latest_entry = _parse_latest_entry(d.pop("latest_entry", UNSET))

        log_summary = cls(
            total_entries=total_entries,
            entries_by_level=entries_by_level,
            entries_by_source=entries_by_source,
            size_bytes=size_bytes,
            earliest_entry=earliest_entry,
            latest_entry=latest_entry,
        )

        log_summary.additional_properties = d
        return log_summary

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
