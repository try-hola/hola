from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.log_level import LogLevel
from ..models.log_source import LogSource
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.log_create_request_context import LogCreateRequestContext


T = TypeVar("T", bound="LogCreateRequest")


@_attrs_define
class LogCreateRequest:
    """Request to create a new log entry.

    Attributes:
        level (LogLevel): Log level enumeration.
        source (LogSource): Log source enumeration.
        message (str): Log message content
        context (Union[Unset, LogCreateRequestContext]): Additional context data
        request_id (Union[None, Unset, str]): Associated request ID
        session_id (Union[None, Unset, str]): Associated session ID
        user_id (Union[None, Unset, str]): Associated user ID
        module (Union[None, Unset, str]): Source module or component
        function (Union[None, Unset, str]): Source function
        line_number (Union[None, Unset, int]): Source line number
        exception_type (Union[None, Unset, str]): Exception type name
        exception_message (Union[None, Unset, str]): Exception message
        stack_trace (Union[None, Unset, str]): Exception stack trace
    """

    level: LogLevel
    source: LogSource
    message: str
    context: Union[Unset, "LogCreateRequestContext"] = UNSET
    request_id: Union[None, Unset, str] = UNSET
    session_id: Union[None, Unset, str] = UNSET
    user_id: Union[None, Unset, str] = UNSET
    module: Union[None, Unset, str] = UNSET
    function: Union[None, Unset, str] = UNSET
    line_number: Union[None, Unset, int] = UNSET
    exception_type: Union[None, Unset, str] = UNSET
    exception_message: Union[None, Unset, str] = UNSET
    stack_trace: Union[None, Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        level = self.level.value

        source = self.source.value

        message = self.message

        context: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.context, Unset):
            context = self.context.to_dict()

        request_id: Union[None, Unset, str]
        if isinstance(self.request_id, Unset):
            request_id = UNSET
        else:
            request_id = self.request_id

        session_id: Union[None, Unset, str]
        if isinstance(self.session_id, Unset):
            session_id = UNSET
        else:
            session_id = self.session_id

        user_id: Union[None, Unset, str]
        if isinstance(self.user_id, Unset):
            user_id = UNSET
        else:
            user_id = self.user_id

        module: Union[None, Unset, str]
        if isinstance(self.module, Unset):
            module = UNSET
        else:
            module = self.module

        function: Union[None, Unset, str]
        if isinstance(self.function, Unset):
            function = UNSET
        else:
            function = self.function

        line_number: Union[None, Unset, int]
        if isinstance(self.line_number, Unset):
            line_number = UNSET
        else:
            line_number = self.line_number

        exception_type: Union[None, Unset, str]
        if isinstance(self.exception_type, Unset):
            exception_type = UNSET
        else:
            exception_type = self.exception_type

        exception_message: Union[None, Unset, str]
        if isinstance(self.exception_message, Unset):
            exception_message = UNSET
        else:
            exception_message = self.exception_message

        stack_trace: Union[None, Unset, str]
        if isinstance(self.stack_trace, Unset):
            stack_trace = UNSET
        else:
            stack_trace = self.stack_trace

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "level": level,
                "source": source,
                "message": message,
            }
        )
        if context is not UNSET:
            field_dict["context"] = context
        if request_id is not UNSET:
            field_dict["request_id"] = request_id
        if session_id is not UNSET:
            field_dict["session_id"] = session_id
        if user_id is not UNSET:
            field_dict["user_id"] = user_id
        if module is not UNSET:
            field_dict["module"] = module
        if function is not UNSET:
            field_dict["function"] = function
        if line_number is not UNSET:
            field_dict["line_number"] = line_number
        if exception_type is not UNSET:
            field_dict["exception_type"] = exception_type
        if exception_message is not UNSET:
            field_dict["exception_message"] = exception_message
        if stack_trace is not UNSET:
            field_dict["stack_trace"] = stack_trace

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.log_create_request_context import LogCreateRequestContext

        d = dict(src_dict)
        level = LogLevel(d.pop("level"))

        source = LogSource(d.pop("source"))

        message = d.pop("message")

        _context = d.pop("context", UNSET)
        context: Union[Unset, LogCreateRequestContext]
        if isinstance(_context, Unset):
            context = UNSET
        else:
            context = LogCreateRequestContext.from_dict(_context)

        def _parse_request_id(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        request_id = _parse_request_id(d.pop("request_id", UNSET))

        def _parse_session_id(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        session_id = _parse_session_id(d.pop("session_id", UNSET))

        def _parse_user_id(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        user_id = _parse_user_id(d.pop("user_id", UNSET))

        def _parse_module(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        module = _parse_module(d.pop("module", UNSET))

        def _parse_function(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        function = _parse_function(d.pop("function", UNSET))

        def _parse_line_number(data: object) -> Union[None, Unset, int]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, int], data)

        line_number = _parse_line_number(d.pop("line_number", UNSET))

        def _parse_exception_type(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        exception_type = _parse_exception_type(d.pop("exception_type", UNSET))

        def _parse_exception_message(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        exception_message = _parse_exception_message(d.pop("exception_message", UNSET))

        def _parse_stack_trace(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        stack_trace = _parse_stack_trace(d.pop("stack_trace", UNSET))

        log_create_request = cls(
            level=level,
            source=source,
            message=message,
            context=context,
            request_id=request_id,
            session_id=session_id,
            user_id=user_id,
            module=module,
            function=function,
            line_number=line_number,
            exception_type=exception_type,
            exception_message=exception_message,
            stack_trace=stack_trace,
        )

        log_create_request.additional_properties = d
        return log_create_request

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
