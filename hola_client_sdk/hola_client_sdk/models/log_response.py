from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.log_entry import LogEntry
    from ..models.log_query_params import LogQueryParams
    from ..models.log_summary import LogSummary


T = TypeVar("T", bound="LogResponse")


@_attrs_define
class LogResponse:
    """Response containing log entries and metadata.

    Attributes:
        entries (list['LogEntry']): List of log entries
        total_count (int): Total number of matching entries
        has_more (bool): Whether more entries are available
        query_params (LogQueryParams): Parameters for querying logs.
        summary (Union['LogSummary', None, Unset]): Log summary statistics
    """

    entries: list["LogEntry"]
    total_count: int
    has_more: bool
    query_params: "LogQueryParams"
    summary: Union["LogSummary", None, Unset] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.log_summary import LogSummary

        entries = []
        for entries_item_data in self.entries:
            entries_item = entries_item_data.to_dict()
            entries.append(entries_item)

        total_count = self.total_count

        has_more = self.has_more

        query_params = self.query_params.to_dict()

        summary: Union[None, Unset, dict[str, Any]]
        if isinstance(self.summary, Unset):
            summary = UNSET
        elif isinstance(self.summary, LogSummary):
            summary = self.summary.to_dict()
        else:
            summary = self.summary

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "entries": entries,
                "total_count": total_count,
                "has_more": has_more,
                "query_params": query_params,
            }
        )
        if summary is not UNSET:
            field_dict["summary"] = summary

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.log_entry import LogEntry
        from ..models.log_query_params import LogQueryParams
        from ..models.log_summary import LogSummary

        d = dict(src_dict)
        entries = []
        _entries = d.pop("entries")
        for entries_item_data in _entries:
            entries_item = LogEntry.from_dict(entries_item_data)

            entries.append(entries_item)

        total_count = d.pop("total_count")

        has_more = d.pop("has_more")

        query_params = LogQueryParams.from_dict(d.pop("query_params"))

        def _parse_summary(data: object) -> Union["LogSummary", None, Unset]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                summary_type_0 = LogSummary.from_dict(data)

                return summary_type_0
            except:  # noqa: E722
                pass
            return cast(Union["LogSummary", None, Unset], data)

        summary = _parse_summary(d.pop("summary", UNSET))

        log_response = cls(
            entries=entries,
            total_count=total_count,
            has_more=has_more,
            query_params=query_params,
            summary=summary,
        )

        log_response.additional_properties = d
        return log_response

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
